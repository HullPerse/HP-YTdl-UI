import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

import "./index.css";
import { queryConfig } from "./config";

const queryClient = new QueryClient(queryConfig);

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

(import.meta.hot.data.root ??= createRoot(elem)).render(app);
