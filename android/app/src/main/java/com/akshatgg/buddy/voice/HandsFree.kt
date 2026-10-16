package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException

/** The spoken chat a hands-free request goes to (the PanelModel behind it). */
interface SpokenChat {
    /** The same chat when it was used within five minutes, so "Priya Sharma" after "Which Priya?" goes on. */
    fun open()
    /** Not on screen: nothing opens, an answer for an app waits in the chat. */
    fun hidden()
    fun sendSpoken(text: String)
    /** The last spoken message is still being answered. */
    val busy: Boolean
}

/**
 * What follows "Hey <name>": the recording is written down by Buddy's server (only now does anything leave the device),
 * and the words go to a chat of their own, not the panel's, through the same path as the 🎤. The chat answers out loud and
 * asks a card's question out loud; a card needs the spoken yes (or its button) as ever. When the words cannot be had,
 * Buddy says why, out loud and in the speech bubble (`bubble`).
 */
class HandsFree(
    private val chat: SpokenChat,
    private val talkBack: TalkBack,
    private val transcribe: suspend (ByteArray, String) -> String,
    private val name: () -> String,
    private val bubble: (String) -> Unit = {},
    private val nameHeard: () -> Boolean = { true }, // "Hey <name>" wakes it too, besides "Hey Buddy" (for the words said back)
) {
    /** The last hands-free turn is still being answered: the wake listener waits. */
    val busy: Boolean get() = chat.busy

    suspend fun request(wav: ByteArray?) {
        if (chat.busy) return tell(VoiceWords.WakeLines.STILL_BUSY) // not written down: the chat would drop it
        if (wav == null || wav.isEmpty()) return tell(VoiceWords.WakeLines.notCaught(name(), nameHeard()))
        val words = try {
            transcribe(wav, "audio/wav").trim()
        } catch (e: CancellationException) {
            throw e
        } catch (e: BuddyError) {
            return tell(if (e.code == "network" || e.code == "timeout") VoiceWords.NO_INTERNET else e.message.orEmpty())
        } catch (e: Exception) {
            return tell(VoiceWords.WakeLines.notCaught(name(), nameHeard()))
        }
        if (words.isEmpty()) return tell(VoiceWords.WakeLines.notCaught(name(), nameHeard()))
        chat.open()
        chat.hidden()
        chat.sendSpoken(words)
    }

    private suspend fun tell(line: String) {
        bubble(line)
        talkBack.say(line)
    }
}
