import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import './index.css';
import { MapDataProvider } from "./context/MapDataContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
    <BrowserRouter>
        <MapDataProvider>
            <App />
            <Toaster position="top-center"/>
        </MapDataProvider>
    </BrowserRouter>
);
