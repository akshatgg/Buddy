package com.akshatgg.buddy.bubble

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HeadViewTest {
    // Made tappable as the service makes the floating head, it still never takes focus, so it never draws the focus
    // highlight (a grey square over its window) after a keyboard is typed on.
    @Test fun aTappableHeadNeverTakesFocus() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val head = HeadView(instrumentation.targetContext)
            head.setOnClickListener {}
            assertFalse(head.isFocusable)
            assertFalse(head.defaultFocusHighlightEnabled)
            head.release()
        }
    }
}
