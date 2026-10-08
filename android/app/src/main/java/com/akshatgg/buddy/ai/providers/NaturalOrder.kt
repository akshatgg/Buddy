package com.akshatgg.buddy.ai.providers

import java.math.BigInteger

/** The order of localeCompare(…, { numeric: true }): digit runs count as numbers ("gemini-10" after "gemini-2"), other text ignores case. */
object NaturalOrder : Comparator<String> {
    private val runs = Regex("\\d+|\\D+")

    override fun compare(a: String, b: String): Int {
        val x = runs.findAll(a).map { it.value }.toList()
        val y = runs.findAll(b).map { it.value }.toList()
        for (i in 0 until minOf(x.size, y.size)) {
            val p = x[i]
            val q = y[i]
            val bothNumbers = p[0].isDigit() && q[0].isDigit()
            val c = if (bothNumbers) BigInteger(p).compareTo(BigInteger(q)) else p.compareTo(q, ignoreCase = true)
            if (c != 0) return c
        }
        return x.size.compareTo(y.size)
    }
}
