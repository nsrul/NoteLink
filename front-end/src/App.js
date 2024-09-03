import { useEffect, useState } from "react";
import "./App.css";
import MainContainer from "./components/MainContainer";
import Navbar from "./components/Navbar";
import axios from "axios";
import Login from "./components/Login";
import SignUp from "./components/Signup";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import HomePage from "./components/HomePage";

// Set up Axios base URL and interceptor for Authorization header
axios.defaults.baseURL = "http://localhost:3500"; // Adjust to API base url

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

function App() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("token")) {
      fetchTasks();
    } else {
      setLoading(false); // Stop loading if there is no token
    }
  }, []);

  const handleUpdateSuccess = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000); // Hide after 2 seconds
  };

  const handleLogin = async (user) => {
    try {
      const response = await axios.post("/login", user);

      if (response.status === 200) {
        console.log("login succwssful");
        localStorage.setItem("token", response.data.token);
        fetchTasks();
      }
    } catch (err) {
      console.error(
        "Login failed: ",
        err.response?.data?.message || err.message
      );
      setError(err.response?.data?.message || "Login failed");
    }
  };

  const fetchTasks = async () => {
    try {
      // const token = localStorage.getItem("token");
      const response = await axios.get("/tasks");
      setTasks(response.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (newTask) => {
    try {
      const response = await axios.post("/tasks", newTask, {
        headers: { "Content-type": "application/json" },
      });
      console.log(response.data);
      fetchTasks(); // Refetch tasks after creation
    } catch (err) {
      setError(err);
      console.error("Error: ", err);
    }
  };

  const handleDeleteTask = async (taskID) => {
    try {
      const response = await axios.delete(`/tasks/${taskID}`);
      console.log("Task deleted: ", response.data);
      fetchTasks();
    } catch (err) {
      console.error("Error deleting the task: ", err);
    }
  };

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/signup" element={<SignUp />} />
          <Route
            path="/tasks"
            element={
              localStorage.getItem("token") ? (
                <>
                  <Navbar
                    onCreateTask={handleCreateTask}
                    showSuccess={showSuccess}
                  />
                  <MainContainer
                    tasks={tasks}
                    error={error}
                    loading={loading}
                    onDeleteTask={handleDeleteTask}
                    setTasks={setTasks}
                    onUpdateSuccess={handleUpdateSuccess}
                  />
                </>
              ) : (
                <Navigate to="/login" />
              )
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
