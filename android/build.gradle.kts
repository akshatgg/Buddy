// AGP 9 compiles Kotlin itself; the Kotlin plugin is listed only to pin its version (Filament 1.77 needs Kotlin 2.4).
plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
}
