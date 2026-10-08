package com.akshatgg.buddy

import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse

class FakeHttp(private val handler: (HttpRequest) -> HttpResponse) : Http {
    val requests = mutableListOf<HttpRequest>()
    override suspend fun send(request: HttpRequest): HttpResponse {
        requests += request
        return handler(request)
    }
}
