package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.AppGraph

/**
 * The hands-free chat ("Hey <name>", AppGraph.handsFreeChat) on screen: the panel's screen on that chat, opened by a tap
 * on its speech bubble or on the head while the bubble is up. Opening it never starts a new chat; closing it ends that one.
 */
class HandsFreeChatActivity : PanelActivity() {
    override val model: PanelModel get() = AppGraph.instance.handsFreeChat

    override fun opened() = Unit // the chat "Hey <name>" started, as it is; onStart puts it on screen (model.shown())

    override fun onStop() {
        if (isFinishing) model.close()
        super.onStop()
    }
}
