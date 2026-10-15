package com.akshatgg.buddy.ui.panel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatHostTest {
    /**
     * The panel gone for good, while Buddy waits for the contacts question: on the main thread the wait goes on at
     * once (as here, unconfined), so the chat must be closed before the no reaches it.
     */
    @Test fun theChatClosesBeforeTheContactsWaitEndsAsANo() {
        val contacts = PendingAnswer(none = false)
        val log = mutableListOf<String>()
        CoroutineScope(Dispatchers.Unconfined).launch { log += "answered ${contacts.ask {}}" }
        closeForGood({ log += "closed" }, contacts)
        assertEquals(listOf("closed", "answered false"), log)
    }

    /** The same with both questions waiting (the contacts one and another, as "make calls"): both end as a no, after. */
    @Test fun theChatClosesBeforeEveryWaitEndsAsANo() {
        val contacts = PendingAnswer(none = false)
        val permission = PendingAnswer(none = false)
        val log = mutableListOf<String>()
        CoroutineScope(Dispatchers.Unconfined).launch { log += "contacts ${contacts.ask {}}" }
        CoroutineScope(Dispatchers.Unconfined).launch { log += "permission ${permission.ask {}}" }
        closeForGood({ log += "closed" }, contacts, permission)
        assertEquals(listOf("closed", "contacts false", "permission false"), log)
    }
}
