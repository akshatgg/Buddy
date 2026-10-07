package com.akshatgg.buddy

import com.akshatgg.buddy.core.Shared
import java.io.File

/** The real shared.json, as the app ships it (JVM tests run with android/app as the working directory). */
object TestShared {
    val shared: Shared by lazy { Shared(File("src/main/assets/shared.json").readText()) }
}
