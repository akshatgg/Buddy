import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Where the server is and how to sign in, from android/cloud.properties (not in git, like cloud.json for the Mac).
val cloud = Properties().apply {
    val file = rootProject.file("cloud.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}
fun cloudValue(name: String) = (cloud.getProperty(name) ?: "").trim()
fun quoted(text: String) = "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// The version: the release workflow passes -PbuddyVersion=1.2.3 (.github/workflows/release.yml); a local build is 0.1.0.
// Android wants a whole number that only goes up, made from the three parts: 1.2.3 is 10203.
val buddyVersion = (findProperty("buddyVersion") as String?)?.trim()?.removePrefix("v")?.ifEmpty { null } ?: "0.1.0"
val buddyVersionCode = buddyVersion.substringBefore('-').split('.').map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

// The release key, from the environment (the release workflow writes it from GitHub's secrets). Without it a release
// build is signed with the debug key, which is fine for checking a build and never for publishing one.
val releaseStore = System.getenv("BUDDY_ANDROID_KEYSTORE")?.ifEmpty { null }?.let { file(it) }

android {
    namespace = "com.akshatgg.buddy"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.akshatgg.buddy"
        minSdk = 26
        targetSdk = 36
        versionCode = buddyVersionCode
        versionName = buddyVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SERVER_URL", quoted(cloudValue("serverUrl")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(cloudValue("firebaseApiKey")))
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(cloudValue("googleWebClientId")))
        // Most phones are arm64, but many budget ones (Android Go) still run 32-bit ARM; x86_64 is for an Intel
        // emulator. Each one adds Filament's native code for it to the APK.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }
    signingConfigs {
        // One debug key in the repository, so that every build has the SHA-1 Firebase knows for Google sign-in.
        getByName("debug") { storeFile = file("debug.keystore") }
        create("release") {
            if (releaseStore != null) {
                storeFile = releaseStore
                storePassword = System.getenv("BUDDY_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("BUDDY_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("BUDDY_ANDROID_KEY_PASSWORD")
            } else {
                storeFile = file("debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }
    buildTypes {
        getByName("release") { signingConfig = signingConfigs.getByName("release") }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    // The buddies are the Mac's own files: one copy in assets/buddies at the repository root.
    sourceSets { getByName("main") { assets.srcDir("../../assets/buddies") } }
    androidResources {
        // The app reads only the models from there: the Mac's previews and its buddies.json stay out of the APK.
        // Any pattern set here replaces Android's own list, so that list comes first.
        ignoreAssetsPatterns += listOf("!.svn", "!.git", "!.ds_store", "!*.scc", ".*", "<dir>_*", "!CVS", "!thumbs.db", "!picasa.ini", "!*~")
        ignoreAssetsPatterns += listOf("!<dir>previews", "!buddies.json")
    }
    testOptions { unitTests.isReturnDefaultValues = true }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

// A build that cannot sign anyone in is no use: say so at once, rather than in the Welcome window.
val checkCloud = tasks.register("checkCloudProperties") {
    doLast {
        val missing = listOf("serverUrl", "firebaseApiKey", "googleWebClientId").filter { cloudValue(it).isEmpty() }
        if (missing.isNotEmpty()) {
            throw GradleException("android/cloud.properties is missing ${missing.joinToString()} (copy cloud.example.properties and fill it in)")
        }
    }
}
tasks.matching { it.name.startsWith("assemble") }.configureEach { dependsOn(checkCloud) }

dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(bom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-service:2.11.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("com.google.android.filament:filament-android:1.77.1")
    implementation("com.google.android.filament:gltfio-android:1.77.1")
    implementation("com.google.android.filament:filament-utils-android:1.77.1")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    androidTestImplementation(bom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
