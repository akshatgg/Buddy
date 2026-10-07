package com.akshatgg.buddy.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import java.net.HttpURLConnection
import java.net.URL

data class HttpRequest(val url: String, val method: String = "GET", val headers: Map<String, String> = emptyMap(), val body: String? = null, val timeoutMs: Int = 60_000)
data class HttpResponse(val status: Int, val body: String)

/** One HTTP request, JSON or form text in and out. Throws IOException when there is no answer (SocketTimeoutException when it took too long). */
interface Http {
    suspend fun send(request: HttpRequest): HttpResponse
}

class UrlConnectionHttp : Http {
    override suspend fun send(request: HttpRequest): HttpResponse = runInterruptible(Dispatchers.IO) {
        val c = URL(request.url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = request.method
            c.connectTimeout = request.timeoutMs
            c.readTimeout = request.timeoutMs
            for ((name, value) in request.headers) c.setRequestProperty(name, value)
            if (request.body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(request.body.toByteArray()) }
            }
            val status = c.responseCode
            val stream = if (status >= 400) c.errorStream else c.inputStream
            HttpResponse(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            c.disconnect()
        }
    }
}
