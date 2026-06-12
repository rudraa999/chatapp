package com.chat.chatapp.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class SpaController {

    @RequestMapping(value = {
        "/login",
        "/register",
        "/chat",
        "/"
    })
    public String redirect() {
        return "forward:/index.html";
    }
}
