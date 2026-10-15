package com.akshatgg.buddy.apps

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.appLine
import com.akshatgg.buddy.message.pickChat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** An app on the phone's home screen: its name there, its package, and the activity the home screen starts. */
data class LauncherApp(val label: String, val pkg: String, val activity: String)

/** The phone's home-screen apps, and starting one. */
interface Launcher {
    suspend fun apps(): List<LauncherApp>
    fun start(app: LauncherApp)
}

/** How an "open YouTube" ended: opened (by its name on the phone), or what Buddy says instead. */
sealed interface Opened {
    data class Done(val label: String) : Opened
    data class Say(val line: String) : Opened
}

/** Open the app the person named; a test passes a fake. */
fun interface AppOpening {
    suspend fun open(asked: String): Opened
}

/**
 * "Open YouTube": the home-screen app of that name (the same rule as for people, shared/message-pick.js), started at
 * once. Two to four that fit ask which one; none or too many say so. Nothing else is opened.
 */
class AppOpener(private val launcher: Launcher) : AppOpening {
    override suspend fun open(asked: String): Opened {
        val apps = launcher.apps()
        val pick = pickChat(asked, apps.map { it.label })
        if (pick !is Pick.One) return Opened.Say(appLine(asked, pick, "phone")!!)
        val app = apps.first { it.label == pick.name }
        return try {
            launcher.start(app)
            Opened.Done(app.label)
        } catch (e: ActivityNotFoundException) {
            Opened.Say("I couldn't open ${app.label}.") // uninstalled or turned off since the list was read
        } catch (e: SecurityException) {
            Opened.Say("I couldn't open ${app.label}.") // an activity that only its own app may start
        }
    }
}

/**
 * The launcher's apps, through the package manager. Android 11 and later list them because the manifest's <queries>
 * names MAIN/LAUNCHER (already there for the chat's app names).
 */
class PhoneLauncher(private val context: Context) : Launcher {
    override suspend fun apps(): List<LauncherApp> = withContext(Dispatchers.IO) {
        val pm = context.packageManager
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found = if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(home, PackageManager.ResolveInfoFlags.of(0))
        else @Suppress("DEPRECATION") pm.queryIntentActivities(home, 0)
        found.map { LauncherApp(it.loadLabel(pm).toString().trim(), it.activityInfo.packageName, it.activityInfo.name) }
            .filter { it.label.isNotEmpty() }
    }

    override fun start(app: LauncherApp) {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(app.pkg, app.activity)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        context.startActivity(intent)
    }
}
