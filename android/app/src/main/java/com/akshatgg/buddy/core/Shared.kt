package com.akshatgg.buddy.core

import android.content.Context
import com.akshatgg.buddy.ai.providers.ProviderFacts
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What the Mac and the phone must say the same way: prompts, limits, messages and provider facts. It is read from
 * shared.json, which tools/sync-android-shared.js makes from shared/, so the two apps cannot drift apart.
 */
class Shared(json: String) {
    private val root = Json.parseToJsonElement(json).jsonObject

    private fun strings(name: String): Map<String, String> =
        root.getValue(name).jsonObject.mapValues { it.value.jsonPrimitive.content }

    val maxTokens: Int = root.getValue("maxTokens").jsonPrimitive.int

    private val limits = root.getValue("limits").jsonObject
    val limitInstruction: Int = limits.getValue("instruction").jsonPrimitive.int
    val limitText: Int = limits.getValue("text").jsonPrimitive.int
    val limitImageChars: Int = limits.getValue("imageChars").jsonPrimitive.int

    val tones: List<String> = root.getValue("tones").jsonArray.map { it.jsonPrimitive.content }
    val defaultTone: String = root.getValue("defaultTone").jsonPrimitive.content

    private val system = root.getValue("system").jsonObject
    val writeSystem: Map<String, String> = system.getValue("write").jsonObject.mapValues { it.value.jsonPrimitive.content }
    val fixSystem: String = system.getValue("fix").jsonPrimitive.content
    val checkSystem: String = system.getValue("check").jsonPrimitive.content

    private val check = root.getValue("check").jsonObject
    val checkDefaultQuestion: String = check.getValue("defaultQuestion").jsonPrimitive.content
    val checkQuestionPrefix: String = check.getValue("questionPrefix").jsonPrimitive.content

    val messages: Map<String, String> = strings("messages")

    val providers: List<ProviderFacts> = root.getValue("providers").jsonArray.map { element ->
        val p = element.jsonObject
        ProviderFacts(
            id = p.getValue("id").jsonPrimitive.content,
            label = p.getValue("label").jsonPrimitive.content,
            keyUrl = p.getValue("keyUrl").jsonPrimitive.content,
            keyPrefixes = p.getValue("keyPrefixes").jsonArray.map { it.jsonPrimitive.content },
            fallbackModels = p.getValue("fallbackModels").jsonArray.map { it.jsonPrimitive.content },
        )
    }

    companion object {
        fun load(context: Context): Shared =
            Shared(context.assets.open("shared.json").bufferedReader().use { it.readText() })
    }
}
