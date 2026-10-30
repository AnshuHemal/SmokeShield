import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { EventsProvider } from "./hooks/useEvents";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <EventsProvider>
          <App />
        </EventsProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
