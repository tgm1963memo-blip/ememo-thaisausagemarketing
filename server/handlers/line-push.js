// /api/line-push.js — Vercel Serverless Function
// แก้ปัญหา CORS ของ LINE API ที่เรียกจาก Browser ตรงๆ ไม่ได้
// Vercel จะรัน function นี้ฝั่ง server แทน

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, message, channelAccessToken } = req.body;

  if (!to || !message || !channelAccessToken) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: "text", text: message }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
