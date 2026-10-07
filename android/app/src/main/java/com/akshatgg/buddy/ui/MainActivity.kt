package com.akshatgg.buddy.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleService

// For now only two buttons, to try the floating buddy; the Welcome and Settings windows replace it.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Button(onClick = ::allowFloating) { Text("Allow floating") }
                    Button(onClick = ::startBuddy) { Text("Start buddy") }
                }
            }
        }
    }

    private fun allowFloating() {
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun startBuddy() {
        AppGraph.instance.settings.buddyOn = true
        BubbleService.start(this)
    }
}
