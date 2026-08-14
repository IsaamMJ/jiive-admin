const TOKEN_KEY = "jiive_admin_token";
const NAME_KEY = "jiive_admin_name";
const ROLE_KEY = "jiive_admin_role";

export const getToken = () =>
  typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;

export const setSession = (token: string, name: string, role: string) => {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(NAME_KEY, name);
  sessionStorage.setItem(ROLE_KEY, role);
};

export const clearToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(NAME_KEY);
  sessionStorage.removeItem(ROLE_KEY);
};

export const getAdminName = () =>
  typeof window !== "undefined" ? (sessionStorage.getItem(NAME_KEY) ?? "") : "";
export const getAdminRole = () =>
  typeof window !== "undefined" ? (sessionStorage.getItem(ROLE_KEY) ?? "") : "";
