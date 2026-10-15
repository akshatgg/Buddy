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

/** Which person it is (shared/message-pick.js) on the phone: every case in pick-cases.json. */
class PickTest {
    private val cases = Json.parseToJsonElement(File("src/test/resources/pick-cases.json").readText()).jsonArray

    @Test fun everyPickCaseIsPickedAsTheJavaScriptPicksIt() {
        assertTrue(cases.size >= 10)
        for (case in cases.map { it.jsonObject }) {
            val asked = case.getValue("asked").jsonPrimitive.content
            val names = case.getValue("names").jsonArray.map { it.jsonPrimitive.content }
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
            val line = case.getValue("line").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(asked, line, pickLine(asked, got))
        }
    }
}
