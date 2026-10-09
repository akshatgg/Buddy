package com.akshatgg.buddy.cloud

import android.util.Log
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.Fact
import com.akshatgg.buddy.store.Memory
import com.akshatgg.buddy.store.MemoryOp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val CHANGE_DELAY_MS = 1_000L // a change is sent this long after the last one, so that a few go together
private const val STALE_MS = 2 * 60_000L // the chat panel syncs on opening only when the last sync is older than this

/**
 * Keeps what this phone knows (Memory) and what the signed-in person's account knows (Buddy's server, POST /api/memory)
 * the same: a sync sends the changes made here and takes the account's facts, with what changed meanwhile on top.
 *
 * It syncs when the app starts with someone signed in and when someone signs in, a second after a change made here,
 * whenever Settings is shown, and when the chat panel opens if the last sync is over two minutes old. There is no
 * timer: every sync is a read of the account's record, and the server's free tier counts them.
 *
 * One sync at a time. A sync asked for while one runs waits for it, and then is not needed when a sync that began
 * after it was asked has gone through (that one sent everything changed by then). A failure (no internet, the server)
 * is quiet: the changes stay in the outbox for the next sync. Signed out, nothing is sent and the changes wait.
 */
class MemorySyncer(
    private val memory: Memory,
    private val user: StateFlow<User?>,
    /** CloudClient.memory: the changes go, the account's facts come back. */
    private val send: suspend (List<MemoryOp>) -> List<Fact>,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val running = Mutex()
    @Volatile private var begun = 0 // syncs begun so far (each one's number)
    @Volatile private var covered = 0 // the number of the last sync that went through
    @Volatile private var lastAt: Long? = null // when the last sync went through, in this run of the app

    /** Sync when someone is signed in (at start, and at every sign-in) and a moment after each change made here. */
    @OptIn(FlowPreview::class)
    fun start() {
        scope.launch {
            user.map { it?.uid }.distinctUntilChanged().collect { if (it != null) sync() }
        }
        scope.launch {
            memory.edits.drop(1).debounce(CHANGE_DELAY_MS).collect { sync() }
        }
    }

    /** Sync now, out of the caller's way: Settings is shown. */
    fun request() {
        scope.launch { sync() }
    }

    /** Sync unless a sync is running or went through less than two minutes ago: the chat panel opens. */
    fun requestIfStale() {
        if (running.isLocked) return
        val at = lastAt
        if (at != null && now() - at < STALE_MS) return
        request()
    }

    /** One sync, after the one running if any; true when it (or one that began after it was asked) went through. */
    suspend fun sync(): Boolean {
        val asked = begun
        return running.withLock {
            if (covered > asked) return@withLock true
            val mine = ++begun
            val ok = once()
            if (ok) covered = mine
            ok
        }
    }

    private suspend fun once(): Boolean {
        val uid = user.value?.uid ?: return false
        val sending = memory.toSend(uid)
        val facts = try {
            send(sending.ops)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Signed out by the server ("signed_out") included: nothing changes here, and the changes wait.
            Log.w("Buddy", "could not sync the memory: ${(e as? BuddyError)?.code ?: e.javaClass.simpleName}")
            return false
        }
        // Someone else signed in meanwhile: the answer is not theirs. Their own sync follows.
        if (user.value?.uid != uid) return false
        memory.synced(sending, facts)
        lastAt = now()
        return true
    }
}
