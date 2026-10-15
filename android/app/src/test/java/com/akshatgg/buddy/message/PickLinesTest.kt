package com.akshatgg.buddy.message

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** What Buddy says for a contact or an app (shared/pick-lines.js) on the phone: every case in line-cases.json. */
class PickLinesTest {
    private val cases = Json.parseToJsonElement(File("src/test/resources/line-cases.json").readText()).jsonArray

    @Test fun everyLineCaseIsSaidAsTheJavaScriptSaysIt() {
        assertTrue(cases.size >= 6)
        for (case in cases.map { it.jsonObject }) {
            val asked = case.getValue("asked").jsonPrimitive.content
            val names = case.getValue("names").jsonArray.map { it.jsonPrimitive.content }
            val where = case.getValue("where").jsonPrimitive.content
            val p = case.getValue("pick").jsonObject
            val expected: Pick = when (val kind = p.getValue("kind").jsonPrimitive.content) {
                "one" -> Pick.One(p.getValue("name").jsonPrimitive.content)
                "choose" -> Pick.Choose(p.getValue("names").jsonArray.map { it.jsonPrimitive.content })
                "none" -> Pick.None
                "many" -> Pick.Many
                else -> error("unknown pick kind $kind")
            }
            val got = pickChat(asked, names)
            assertEquals(asked, expected, got)
            fun line(name: String) = case.getValue(name).let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(asked, line("contact"), contactLine(asked, got))
            assertEquals(asked, line("app"), appLine(asked, got, where))
        }
    }
}
