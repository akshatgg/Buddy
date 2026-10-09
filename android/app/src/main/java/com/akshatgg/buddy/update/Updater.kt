package com.akshatgg.buddy.update

import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.store.KeyValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest

/** How often Buddy looks for a new version on its own (it always does when the person asks). */
const val UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000L

const val UPDATE_OFFLINE = "Couldn't check for updates. Check your internet and try again."
const val UPDATE_DAMAGED = "The download was damaged. Try again."
const val UPDATE_FAILED = "Couldn't download the update. Try again."
const val UPDATE_NOT_INSTALLED = "Android couldn't install the update. Try again."
const val UPDATE_CONFLICT = "This Buddy was installed another way, so it can't update itself. Get the new one from the website."
const val UPDATE_NO_SPACE = "There isn't enough space on the phone for the update."

/** How Android's installer ended an update that did not happen. */
enum class InstallEnd { DECLINED, CONFLICT, NO_SPACE, FAILED }

/** Where Buddy's update stands, as Settings shows it. */
sealed interface UpdateState {
    /** Not looked yet (or a look on its own failed quietly). */
    data object Unknown : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    /** A newer version is out: "Update now". */
    data class Available(val release: AndroidRelease) : UpdateState
    /** Buddy may not install apps yet: Android's "Install unknown apps" switch, once. */
    data class NeedsPermission(val release: AndroidRelease) : UpdateState
    /** Downloading, `fraction` 0 to 1 (0 while its size is not known). */
    data class Downloading(val release: AndroidRelease, val fraction: Float) : UpdateState
    /** Handed to Android's installer, which asks the person and installs it over this Buddy. */
    data class Installing(val release: AndroidRelease) : UpdateState
    data class Failed(val message: String, val release: AndroidRelease?) : UpdateState
}

/**
 * Buddy for Android's "Update now", as the Mac's (src/main/updates.js): it looks for a newer Android release on GitHub
 * (when the app opens, at most every UPDATE_CHECK_EVERY_MS, and whenever the person asks), downloads its APK into `dir`,
 * checks its size and SHA-256, and hands it to Android's installer. The new APK is signed with the same release key, so
 * it installs over this one and keeps everything. `download(url, file, progress)` writes a URL into a file, telling
 * how much of it came (bytes); `canInstall()` says whether Buddy may install apps; `install(file)` starts Android's
 * installer. Plain Kotlin, tested on the JVM.
 */
class Updater(
    private val http: Http,
    private val current: String,
    private val dir: File,
    private val kv: KeyValue,
    private val scope: CoroutineScope,
    private val download: suspend (String, File, (Long) -> Unit) -> Unit,
    private val canInstall: () -> Boolean,
    private val install: suspend (File) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val state0 = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    val state: StateFlow<UpdateState> = state0.asStateFlow()
    private var job: Job? = null

    /** Look for a new version: always when `asked` (the person tapped), else only once the last look is old enough. */
    fun check(asked: Boolean = false) {
        if (job?.isActive == true) return
        val last = kv.getString(LAST_CHECK)?.toLongOrNull() ?: 0L
        if (!asked && now() - last < UPDATE_CHECK_EVERY_MS && state0.value != UpdateState.Unknown) return
        job = scope.launch {
            if (asked) state0.value = UpdateState.Checking
            val found = try {
                val r = http.send(HttpRequest(RELEASES_URL, headers = mapOf("Accept" to "application/vnd.github+json", "User-Agent" to "Buddy-Android"), timeoutMs = 15_000))
                if (r.status != 200) throw IllegalStateException("GitHub answered ${r.status}")
                AppUpdate.newestAndroid(r.body)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Quietly on its own (it looks again later); in words when the person asked.
                state0.value = if (asked) UpdateState.Failed(UPDATE_OFFLINE, null) else UpdateState.Unknown
                return@launch
            }
            kv.putString(LAST_CHECK, now().toString())
            state0.value = if (found != null && AppUpdate.isNewer(found.version, current)) UpdateState.Available(found) else UpdateState.UpToDate
        }
    }

    /** "Update now": once Buddy may install apps, download the new APK, check it, and hand it to Android's installer. */
    fun updateNow() {
        val release = when (val s = state0.value) {
            is UpdateState.Available -> s.release
            is UpdateState.NeedsPermission -> s.release
            is UpdateState.Failed -> s.release ?: return
            else -> return
        }
        if (job?.isActive == true) return
        if (!canInstall()) {
            state0.value = UpdateState.NeedsPermission(release)
            return
        }
        job = scope.launch {
            state0.value = UpdateState.Downloading(release, 0f)
            val file = File(dir, APK_NAME)
            try {
                dir.mkdirs()
                file.delete()
                download(release.apkUrl, file) { got ->
                    val fraction = if (release.size > 0) (got.toFloat() / release.size).coerceIn(0f, 1f) else 0f
                    state0.value = UpdateState.Downloading(release, fraction)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                file.delete()
                state0.value = UpdateState.Failed(UPDATE_FAILED, release)
                return@launch
            }
            if (!intact(file, release)) {
                file.delete()
                state0.value = UpdateState.Failed(UPDATE_DAMAGED, release)
                return@launch
            }
            state0.value = UpdateState.Installing(release)
            try {
                install(file)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state0.value = UpdateState.Failed(UPDATE_NOT_INSTALLED, release)
            }
        }
    }

    /**
     * Android's installer did not install it: the person said no (offered again), or why not, in plain words. A
     * conflict is a Buddy signed with another key (installed some other way): Android will not replace it.
     */
    fun installEnded(end: InstallEnd) {
        val s = state0.value as? UpdateState.Installing ?: return
        state0.value = when (end) {
            InstallEnd.DECLINED -> UpdateState.Available(s.release)
            InstallEnd.CONFLICT -> UpdateState.Failed(UPDATE_CONFLICT, null)
            InstallEnd.NO_SPACE -> UpdateState.Failed(UPDATE_NO_SPACE, s.release)
            InstallEnd.FAILED -> UpdateState.Failed(UPDATE_NOT_INSTALLED, s.release)
        }
    }

    /** The person came back from Android's settings: with the switch on now, the update goes on. */
    fun resumed() {
        val s = state0.value
        if (s is UpdateState.NeedsPermission && canInstall()) updateNow()
    }

    companion object {
        private const val LAST_CHECK = "lastUpdateCheck"

        /** Whether `file` is the release's APK as published: its size, and its SHA-256 when GitHub gave one. */
        fun intact(file: File, release: AndroidRelease): Boolean {
            if (!file.isFile || (release.size > 0 && file.length() != release.size)) return false
            val sha = release.sha256 ?: return true
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    digest.update(buffer, 0, n)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) } == sha
        }
    }
}
