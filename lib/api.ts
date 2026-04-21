import axios from "axios";
import { getToken, clearToken } from "./auth";

const api = axios.create({
  baseURL: "https://d3pvjhguhk37b0.cloudfront.net/api/v1/admin",
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
