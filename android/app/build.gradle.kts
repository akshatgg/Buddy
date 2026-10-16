import java.io.File
import java.net.URI
import java.security.MessageDigest
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

// "Only my voice": sherpa-onnx's speaker embedding extractor (Apache 2.0), onnxruntime linked in. Not on Maven Central:
// fetched once from its GitHub release and kept only when its SHA-256 is this one.
val sherpaVersion = "1.13.8"
val sherpaAar = layout.projectDirectory.file("libs/sherpa-onnx-static-link-onnxruntime-$sherpaVersion.aar")
val sherpaSha256 = "b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471"
val fetchSherpaOnnx by tasks.registering {
    outputs.file(sherpaAar)
    doLast {
        val out = sherpaAar.asFile
        fun sha(f: File) = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }
        if (out.isFile && sha(out) == sherpaSha256) return@doLast
        out.parentFile.mkdirs()
        val part = File(out.path + ".part")
        URI("https://github.com/k2-fsa/sherpa-onnx/releases/download/v$sherpaVersion/${out.name}").toURL().openStream().use { input -> part.outputStream().use { input.copyTo(it) } }
        check(sha(part) == sherpaSha256) { "sherpa-onnx AAR did not match its SHA-256" }
        part.renameTo(out)
    }
}
tasks.named("preBuild") { dependsOn(fetchSherpaOnnx) }

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
        // emulator, and only debug builds carry that one (below). Each one adds Filament's native code to the APK.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
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
        getByName("debug") { ndk { abiFilters += "x86_64" } }
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
    // Minify is off. If it is ever turned on, it needs: -keep class com.k2fsa.sherpa.onnx.** { *; }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
        // Keeps the native libraries uncompressed-out of the APK's way: the APK is about 17 MB larger instead of about 40.
        jniLibs { useLegacyPackaging = true }
    }
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
    // Buddy's ears: Vosk, offline speech recognition (Apache 2.0), and the JNA it calls its native code through.
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
    // Buddy's "Only my voice": sherpa-onnx speaker embeddings (see fetchSherpaOnnx above).
    implementation(files(sherpaAar))
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    androidTestImplementation(bom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
