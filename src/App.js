import React, { useEffect, useState } from "react";
import "./App.css";
import logo from "./logo.png";

function App() {
  const [time, setTime] = useState(new Date());
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("Idle");
  const [token, setToken] = useState(null);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Check URL for OAuth token
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("token");
    const urlUser = urlParams.get("user");

    if (urlToken && urlUser) {
      try {
        const userData = JSON.parse(decodeURIComponent(urlUser));
        setToken(urlToken);
        setUser(userData);
        setSignedIn(true);
        localStorage.setItem("token", urlToken);
        localStorage.setItem("user", JSON.stringify(userData));

        window.history.replaceState({}, document.title, "/");

        fetchLogs(urlToken);
      } catch (error) {
        console.error("Error parsing user data from URL:", error);
      }
    }
  }, []);

  // Load from localStorage if available
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
        setSignedIn(true);
        fetchLogs(savedToken);
      } catch (error) {
        console.error("Error parsing saved user data:", error);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
    }
  }, []);

  // Fetch logs from backend
  const fetchLogs = async (authToken = token) => {
    if (!authToken) return;

    try {
      const res = await fetch("http://localhost:5000/logs", {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  };

  const notifyServer = async (action) => {
    if (!token) {
      alert("Please login first");
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        alert("Session expired. Please login again.");
        return;
      }

      alert(`${action.toUpperCase()} Recorded\nTime: ${time.toLocaleTimeString()}`);
      setStatus(action.toUpperCase());

      if (action === "logout") {
        handleLogout();
      } else {
        fetchLogs();
      }
    } catch (err) {
      alert("Server error: " + err.message);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "http://localhost:5000/auth/google";
  };

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch("http://localhost:5000/api/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setSignedIn(false);
      setUser(null);
      setToken(null);
      setLogs([]);
      setStatus("Idle");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="clock-area">
          <div className="time">{time.toLocaleTimeString()}</div>
          <div className="status">
            Status: <span className={`status-tag ${status.toLowerCase()}`}>{status}</span>
          </div>
        </div>
        <div className="logo">
          <img src={logo} alt="Logo" />
        </div>
        <div className="auth">
          {signedIn ? (
            <div className="logged-in">
              <div>🔓 Logged In</div>
              <div style={{ fontSize: "0.8em", marginTop: "4px" }}>
                {user?.name || user?.email}
              </div>
            </div>
          ) : (
            <button onClick={handleGoogleLogin} className="google-login-btn">
              Login with Google
            </button>
          )}
        </div>
      </header>

      <section className="actions">
        <h2>Actions</h2>
        <div className="action-buttons">
          <button disabled={signedIn} onClick={handleGoogleLogin}>
            Login with Google
          </button>
          <button disabled={!signedIn} onClick={() => notifyServer("break")}>
            Break
          </button>
          <button disabled={!signedIn} onClick={() => notifyServer("resume")}>
            Resume
          </button>
          <button disabled={!signedIn} onClick={() => notifyServer("lunch")}>
            Lunch
          </button>
          <button disabled={!signedIn} onClick={() => notifyServer("back-online")}>
            Back from Lunch
          </button>
          <button disabled={!signedIn} className="logout" onClick={() => notifyServer("logout")}>
            Logout
          </button>
        </div>
      </section>

      <section className="logs">
        <h2>Today's Activity</h2>
        {signedIn && user && (
          <p style={{ fontSize: "0.9em", marginBottom: "10px", color: "#666" }}>
            Showing logs for: {user.name} ({user.email})
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, index) => (
              <tr key={index}>
                <td>{log.action}</td>
                <td>
                  {new Date(log.timestamp).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;
