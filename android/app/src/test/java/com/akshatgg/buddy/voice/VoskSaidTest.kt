package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class VoskSaidTest {
    @Test fun aFinalResultGivesWordsWithTimesAndConfidences() {
        val said = parseVosk("""{"result":[{"conf":0.9,"end":1.2,"start":0.8,"word":"haan"},{"conf":0.5,"end":1.6,"start":1.3,"word":"send"}],"text":"haan send"}""")
        assertEquals("haan send", said.text)
        assertEquals(listOf(VoskWord("haan", 0.9f, 0.8f, 1.2f), VoskWord("send", 0.5f, 1.3f, 1.6f)), said.words)
    }
    @Test fun aPartialGivesTextAndNoWords() {
        assertEquals(VoskSaid("hey", emptyList()), parseVosk("""{"partial":"hey"}"""))
    }
    @Test fun badJsonIsNothing() {
        assertEquals(VoskSaid("", emptyList()), parseVosk("not json"))
    }
}
