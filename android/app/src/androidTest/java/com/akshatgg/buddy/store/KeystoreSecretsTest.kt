package com.akshatgg.buddy.store

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeystoreSecretsTest {
    @Test fun aSecretIsKeptEncryptedAndCanBeCleared() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val kv = SharedPrefsKeyValue(context, "secrets-test")
        val secrets = KeystoreSecrets(kv)
        secrets.set("openai", "sk-test-123")
        assertEquals("sk-test-123", KeystoreSecrets(kv).get("openai"))
        assertNotEquals("sk-test-123", kv.getString("secret.openai"))
        secrets.clear("openai")
        assertFalse(secrets.has("openai"))
    }
}
