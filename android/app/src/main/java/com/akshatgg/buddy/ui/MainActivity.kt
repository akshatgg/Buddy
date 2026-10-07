package com.akshatgg.buddy.ui

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import com.akshatgg.buddy.bubble.HeadView
import com.akshatgg.buddy.bubble.Mood

// For now this only shows the two heads on a coloured background, to check how they look;
// the Welcome and Settings windows replace it.
class MainActivity : ComponentActivity() {
    private val heads = mutableListOf<HeadView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#2878C8")) }
        val size = (220 * resources.displayMetrics.density).toInt()
        for ((i, id) in listOf("boy-1", "girl-1").withIndex()) {
            val head = HeadView(this).apply {
                characterId = id
                mood = Mood.WAVE
            }
            val place = FrameLayout.LayoutParams(size, size, Gravity.CENTER_HORIZONTAL)
            place.topMargin = size / 2 + i * (size + size / 4)
            root.addView(head, place)
            heads += head
        }
        setContentView(root)
    }

    override fun onDestroy() {
        heads.forEach { it.release() }
        super.onDestroy()
    }
}
