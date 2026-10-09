package com.akshatgg.buddy.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
import com.akshatgg.buddy.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The phone's side of "Update now" (Updater): downloading the APK, Android's "Install unknown apps" switch for Buddy,
 * and Android's installer, which asks the person and installs the new APK over this Buddy (the same release key, so
 * everything is kept). Its answer comes back to InstallResult.
 */
object ApkInstaller {
    private const val DOWNLOAD_TIMEOUT_MS = 30_000

    /** Write `url` into `file`, telling `progress` the bytes so far. GitHub's download link is followed to its file. */
    suspend fun download(url: String, file: File, progress: (Long) -> Unit) = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = true
            c.connectTimeout = DOWNLOAD_TIMEOUT_MS
            c.readTimeout = DOWNLOAD_TIMEOUT_MS
            c.setRequestProperty("User-Agent", "Buddy-Android")
            if (c.responseCode != 200) throw IllegalStateException("download answered ${c.responseCode}")
            c.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var got = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        got += n
                        progress(got)
                    }
                }
            }
        } finally {
            c.disconnect()
        }
    }

    /** Whether Buddy may install apps (Android's "Install unknown apps", Settings → Apps → Buddy). */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Android's "Install unknown apps" switch for Buddy, to turn on once. */
    fun permissionIntent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Hand `apk` to Android's installer. It answers InstallResult: first to ask the person, then how it went. */
    suspend fun install(context: Context, apk: File) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite(APK_NAME, 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val answer = Intent(context, InstallResult::class.java)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            session.commit(PendingIntent.getBroadcast(context, id, answer, flags).intentSender)
        }
    }
}

/**
 * Android's installer's answers about an update: it needs the person to say yes (its own screen is shown), it is done
 * (Buddy is replaced, and this process with it), or it failed or the person said no (the update is offered again).
 */
class InstallResult : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updater = AppGraph.instance.updater
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT))
                if (confirm == null) {
                    updater.installEnded(InstallEnd.FAILED)
                    return
                }
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // Buddy is replaced; the new one starts afresh
            PackageInstaller.STATUS_FAILURE_ABORTED -> updater.installEnded(InstallEnd.DECLINED) // the person said no
            else -> {
                Log.w("Buddy", "update: the installer said $status")
                updater.installEnded(
                    when (status) {
                        PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> InstallEnd.CONFLICT
                        PackageInstaller.STATUS_FAILURE_STORAGE -> InstallEnd.NO_SPACE
                        else -> InstallEnd.FAILED
                    },
                )
            }
        }
    }
}
