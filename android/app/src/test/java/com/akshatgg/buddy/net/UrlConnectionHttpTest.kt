package com.akshatgg.buddy.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/** The real client, against a server on this computer. */
class UrlConnectionHttpTest {
    @Test fun anAnswerComesBackWithItsStatusAndBody() = runBlocking {
        ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
            server.soTimeout = 5_000
            val answering = thread {
                server.accept().use { connection ->
                    readRequest(connection.getInputStream())
                    val answer = "HTTP/1.1 400 Bad Request\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnope"
                    connection.getOutputStream().write(answer.toByteArray())
                }
            }
            val response = UrlConnectionHttp().send(HttpRequest("http://127.0.0.1:${server.localPort}/", timeoutMs = 5_000))
            answering.join()
            assertEquals(HttpResponse(400, "nope"), response)
        }
    }

    @Test fun noServerIsAnIOException() = runBlocking {
        val port = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort } // closed: nobody listens
        try {
            UrlConnectionHttp().send(HttpRequest("http://127.0.0.1:$port/", timeoutMs = 5_000))
            fail("answered")
        } catch (e: IOException) {
            // as the routing expects: no answer
        }
    }

    // A server that takes the request and never answers. A socket read does not stop when its thread is interrupted,
    // so a request whose caller lets go of it must close its connection, or it holds a thread for its timeout, a minute.
    @Test fun aRequestLetGoOfClosesItsConnectionAtOnce() {
        ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
            server.soTimeout = 5_000
            val caller = CoroutineScope(Dispatchers.Default)
            try {
                val call = caller.launch { UrlConnectionHttp().send(HttpRequest("http://127.0.0.1:${server.localPort}/")) }
                server.accept().use { connection ->
                    connection.soTimeout = 5_000
                    val fromBuddy = connection.getInputStream()
                    readRequest(fromBuddy) // all of it: Buddy now waits for an answer
                    val start = System.nanoTime()
                    call.cancel()
                    // Closed by Buddy: the read ends, where it would otherwise time out after 5 s.
                    assertEquals(-1, fromBuddy.read())
                    runBlocking { withTimeout(2_000) { call.join() } }
                    val ms = (System.nanoTime() - start) / 1_000_000
                    assertTrue("took $ms ms", ms < 2_000)
                }
            } finally {
                caller.cancel()
            }
        }
    }

    /** Reads a request with no body, up to the blank line after its headers. */
    private fun readRequest(input: InputStream) {
        val end = "\r\n\r\n"
        val seen = StringBuilder()
        while (!seen.endsWith(end)) {
            val b = input.read()
            check(b != -1) { "the request ended early" }
            seen.append(b.toChar())
        }
    }
}
