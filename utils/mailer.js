const nodemailer = require("nodemailer");

const sendMail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"UNIOSUNTrack" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    };

    const deliveredMail = await transporter.sendMail(mailOptions);
    console.log("✅ Mail sent:", deliveredMail.response);
    return "Mail sent successfully";
  } catch (error) {
    console.error("❌ Mail error:", error);
    throw new Error("Email could not be sent");
  }
};

// ======================
// 📧 Email Templates (Styled)
// ======================

const baseTemplate = (title, content, buttonText, buttonLink, buttonColor) => {
  return `
  <html>
    <head>
      <style>
        :root {
          --un-primary: #0B6623;
          --un-accent: #FBBF24;
          --un-bg: #F9FAFB;
          --un-text: #1E293B;
        }

        body {
          background-color: var(--un-bg);
          color: var(--un-text);
          font-family: 'Segoe UI', Arial, sans-serif;
          padding: 0;
          margin: 0;
        }

        .container {
          max-width: 500px;
          background: #fff;
          margin: 40px auto;
          border-radius: 10px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .header {
          background-color: var(--un-primary);
          color: #fff;
          text-align: center;
          padding: 20px;
        }

        .header h2 {
          margin: 0;
          font-size: 22px;
        }

        .body {
          padding: 25px;
          line-height: 1.7;
        }

        .btn {
          display: inline-block;
          margin-top: 15px;
          padding: 12px 22px;
          background: ${buttonColor};
          color: #fff !important;
          text-decoration: none;
          font-weight: bold;
          border-radius: 8px;
        }

        .footer {
          text-align: center;
          font-size: 13px;
          color: #888;
          padding: 15px 0 25px 0;
        }
      </style>
    </head>

    <body>
      <div class="container">
        <div class="header">
          <h2>${title}</h2>
        </div>
        <div class="body">
          ${content}
          ${
            buttonText && buttonLink
              ? `<a href="${buttonLink}" class="btn">${buttonText}</a>`
              : ""
          }
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} UNIOSUNTrack. All rights reserved.</p>
        </div>
      </div>
    </body>
  </html>
  `;
};

// ======================= EMAIL TYPES =======================

// Email Verification
const sendVerificationEmail = (email, username, link) => {
  const content = `
    <p>Hi <strong>${username}</strong>,</p>
    <p>Thanks for joining <b>UNIOSUNTrack</b>! Please verify your email address to get started.</p>
  `;
  const html = baseTemplate(
    "Verify Your Email",
    content,
    "Verify Email",
    link,
    "#0B6623"
  );
  return sendMail(email, "Verify Your Email", html);
};

// Password Reset
const sendResetPasswordEmail = (email, username, link) => {
  const content = `
    <p>Hello <strong>${username}</strong>,</p>
    <p>We received a request to reset your password on <b>UNIOSUNTrack</b>. Click below to set a new password (valid for 30 minutes):</p>
  `;
  const html = baseTemplate(
    "Reset Your Password",
    content,
    "Reset Password",
    link,
    "#3b82f6"
  );
  return sendMail(email, "Password Reset Request", html);
};

// Teacher Credentials
const sendTeacherCredentialsEmail = (email, username, password) => {
  const content = `
    <p>Hi <strong>${username}</strong>,</p>
    <p>Your teacher account on <b>UNIOSUNTrack</b> has been created. You can now log in with the following credentials:</p>
    <ul>
      <li><b>Email:</b> ${email}</li>
      <li><b>Password:</b> ${password}</li>
    </ul>
    <p>Please change your password immediately after your first login for security reasons.</p>
  `;
  const html = baseTemplate(
    "Your Teacher Account Credentials",
    content,
    "Login Now",
    `${process.env.FRONTEND_URL}/login`,
    "#22c55e"
  );
  return sendMail(email, "Your Teacher Account Credentials", html);
};

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendTeacherCredentialsEmail,
};
