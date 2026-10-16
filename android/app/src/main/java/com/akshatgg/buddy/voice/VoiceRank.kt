package com.akshatgg.buddy.voice

/** A voice of the phone's TextToSpeech, without Android in it (so the ranking can be tested). */
data class VoiceInfo(
    val name: String,
    /** "en-IN" or "en_IN". */
    val lang: String,
    /** android.speech.tts.Voice.QUALITY_*: 100 very low … 500 very high. */
    val quality: Int,
    val network: Boolean,
    val features: Set<String> = emptySet(),
)

/** Which voice sounds best: English only, India first, then US, GB, other English; better quality first, local before network. */
object VoiceRank {
    const val NORMAL = 300
    const val HIGH = 400
    const val VERY_HIGH = 500
    private const val NOT_INSTALLED = "notInstalled" // TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED
    private val ORDER = listOf("in", "us", "gb")
    private val REGIONS = mapOf("in" to "India", "us" to "US", "gb" to "UK", "au" to "Australia", "ca" to "Canada", "ie" to "Ireland", "za" to "South Africa", "nz" to "New Zealand")

    private fun parts(lang: String) = lang.lowercase().split('-', '_')
    private fun region(v: VoiceInfo) = parts(v.lang).getOrNull(1).orEmpty()

    /** The English voices that are installed, best first. */
    fun ranked(voices: List<VoiceInfo>): List<VoiceInfo> =
        voices.filter { parts(it.lang).firstOrNull() == "en" && NOT_INSTALLED !in it.features }
            .sortedWith(
                compareBy<VoiceInfo> { ORDER.indexOf(region(it)).let { i -> if (i < 0) ORDER.size else i } }
                    .thenByDescending { it.quality }
                    .thenBy { it.network },
            )

    fun best(voices: List<VoiceInfo>): String? = ranked(voices).firstOrNull()?.name

    /** The voice to speak with: the chosen one if it is still on the phone, else the best (null if there is none). */
    fun resolve(chosen: String?, voices: List<VoiceInfo>): String? {
        val list = ranked(voices)
        return list.firstOrNull { it.name == chosen }?.name ?: list.firstOrNull()?.name
    }

    /** Menu texts for a ranked list, in the same order: "India 1 (High quality)", "US 2 (needs internet)". */
    fun labels(ranked: List<VoiceInfo>): List<String> {
        val seen = HashMap<String, Int>()
        return ranked.map { v ->
            val r = region(v)
            val place = REGIONS[r] ?: r.uppercase().ifEmpty { "English" }
            val n = (seen[place] ?: 0) + 1
            seen[place] = n
            val note = when {
                v.network -> " (needs internet)"
                v.quality >= HIGH -> " (High quality)"
                else -> ""
            }
            "$place $n$note"
        }
    }
}
