package com.akshatgg.buddy.typing

import android.content.Context
import com.akshatgg.buddy.bubble.LookService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The chat's TypeIn through LookService. Reading and setting a box are calls into the other app's process, so they
 * are made off the main thread.
 */
class ServiceTypeIn(private val context: Context) : TypeIn {
    override fun on(): Boolean = LookService.isEnabled(context)

    override fun appName(): String? = LookService.running?.appName()

    override suspend fun read(): BoxText? = withContext(Dispatchers.Default) { LookService.running?.read() }

    override suspend fun write(text: String, cursor: Int): Boolean =
        withContext(Dispatchers.Default) { LookService.running?.write(text, cursor) == true }
}
