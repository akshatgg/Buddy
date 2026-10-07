package com.akshatgg.buddy.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.HttpURLConnection
import java.net.URL

data class HttpRequest(val url: String, val method: String = "GET", val headers: Map<String, String> = emptyMap(), val body: String? = null, val timeoutMs: Int = 60_000)
data class HttpResponse(val status: Int, val body: String)

/** One HTTP request, JSON or form text in and out. Throws IOException when there is no answer (SocketTimeoutException when it took too long). */
interface Http {
    suspend fun send(request: HttpRequest): HttpResponse
}

class UrlConnectionHttp : Http {
    // A socket read does not stop when its thread is interrupted, so a request whose caller lets go of it would hold a
    // thread until its timeout, up to a minute. Its connection is closed instead, which ends the read at once; the
    // caller has already moved on.
    override suspend fun send(request: HttpRequest): HttpResponse {
        val c = URL(request.url).openConnection() as HttpURLConnection // nothing is sent yet
        return suspendCancellableCoroutine { asked ->
            asked.invokeOnCancellation { c.disconnect() }
            Dispatchers.IO.asExecutor().execute {
                if (asked.isActive) asked.resumeWith(runCatching { exchange(c, request) }) // not if let go of already
            }
        }
    }

    private fun exchange(c: HttpURLConnection, request: HttpRequest): HttpResponse {
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
            return HttpResponse(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            c.disconnect()
        }
    }
}
