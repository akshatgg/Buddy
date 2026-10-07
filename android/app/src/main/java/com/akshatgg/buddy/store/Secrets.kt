package com.akshatgg.buddy.store

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** API keys and the sign-in token: kept where nothing else on the phone can read them. */
interface Secrets {
    fun get(id: String): String?
    fun set(id: String, value: String)
    fun clear(id: String)
    fun has(id: String): Boolean = get(id) != null
}

/**
 * Secrets encrypted with an AES-256 key that lives in the phone's keystore and never leaves it, so a copy of the
 * app's files (a backup, a rooted peek) holds only ciphertext. A value that cannot be decrypted (the key was lost,
 * say after a restore onto another phone) reads as missing, so the person is asked for it again instead of the app
 * failing.
 */
class KeystoreSecrets(private val kv: KeyValue) : Secrets {
    override fun get(id: String): String? {
        val stored = kv.getString(slot(id)) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
            String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    override fun set(id: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        // The cipher picks a fresh IV for every encryption; it is kept in front of the ciphertext.
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        kv.putString(slot(id), Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    override fun clear(id: String) = kv.putString(slot(id), null)

    private fun slot(id: String) = "secret.$id"

    // One at a time: two first uses at once would each make a key, and the second would replace the first, so that
    // whatever was saved with the first could no longer be read.
    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val ALIAS = "buddy-secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}

/** For tests that need secrets without a keystore. */
class MemorySecrets : Secrets {
    private val map = HashMap<String, String>()

    override fun get(id: String): String? = map[id]

    override fun set(id: String, value: String) {
        map[id] = value
    }

    override fun clear(id: String) {
        map.remove(id)
    }
}
