/** Read Firebase auth action params from query string or hash fragment. */
export function getAuthActionParams() {
  const fromSearch = new URLSearchParams(window.location.search);
  if (fromSearch.get("oobCode")) return fromSearch;

  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("oobCode")) return new URLSearchParams(hash);

  return fromSearch;
}

export function isResetPasswordLink() {
  const params = getAuthActionParams();
  return params.get("mode") === "resetPassword" && !!params.get("oobCode");
}

export function getPublicMemoParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    memoId: params.get("viewMemo") || params.get("memoId") || "",
    token: params.get("token") || "",
  };
}

export function isPublicMemoLink() {
  const { memoId, token } = getPublicMemoParams();
  return !!(memoId && token);
}
