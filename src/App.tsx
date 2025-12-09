import { createRoot } from "react-dom/client";

function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Agent Hub</h1>
      <p>Hello World 👋</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
