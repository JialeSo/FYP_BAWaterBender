import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import './index.css';
import { MapDataProvider } from "./context/mapDataContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
    <BrowserRouter>
        <App />
        <Toaster position="top-center"/>
    </BrowserRouter>
);
