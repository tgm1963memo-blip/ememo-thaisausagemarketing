export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { mode, title, category, brief, content } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY ไม่ได้ตั้งค่า กรุณาตั้งค่าใน Vercel Environment Variables" });

  let systemPrompt, userMessage;

  if (mode === "write") {
    systemPrompt = `คุณเป็นผู้ช่วยเขียนเอกสาร Memo ภาษาไทยสำหรับองค์กร บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด เขียนภาษาไทยที่เป็นทางการ กระชับ และชัดเจน ใช้รูปแบบ Memo มาตรฐาน`;
    userMessage = `ชื่อเรื่อง: ${title || "(ไม่ระบุ)"}
หมวดหมู่: ${category || "ทั่วไป"}
บรีฟ/วัตถุประสงค์: ${brief}

กรุณาเขียนเนื้อหา Memo ที่สมบูรณ์และเป็นทางการ ประกอบด้วย:
1. วัตถุประสงค์/ที่มา
2. รายละเอียด/เหตุผล
3. ข้อเสนอ/ขออนุมัติ
4. สรุป

เขียนเป็น HTML ที่เรียบง่าย ใช้ได้แค่ <p>, <ul>, <li>, <strong>, <br> เท่านั้น ไม่ใช้ tag อื่น`;
  } else if (mode === "summarize") {
    systemPrompt = `คุณเป็นผู้ช่วยวิเคราะห์และสรุปเอกสาร Memo ภาษาไทย วิเคราะห์อย่างละเอียดและตรงประเด็น`;
    userMessage = `ชื่อเรื่อง: ${title || "(ไม่ระบุ)"}

เนื้อหาเอกสาร:
${content || "(ไม่มีเนื้อหา)"}

กรุณาสรุปในรูปแบบ JSON เท่านั้น (ไม่มีข้อความอื่นนอก JSON):
{
  "summary": "สาระสำคัญ 2-3 ประโยค",
  "budget": "รายละเอียดงบประมาณที่พบในเอกสาร (ถ้าไม่มีให้เป็น null)",
  "risks": ["ความเสี่ยงหรือข้อควรระวังที่พบ"],
  "keyPoints": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2"]
}`;
  } else {
    return res.status(400).json({ error: "mode ไม่ถูกต้อง (ใช้ write หรือ summarize)" });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.7 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini API error");

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("ไม่ได้รับผลลัพธ์จาก Gemini");

    if (mode === "summarize") {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      return res.json(parsed);
    }

    return res.json({ content: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
