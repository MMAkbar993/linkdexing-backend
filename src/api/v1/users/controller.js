const bcrypt = require("bcryptjs");
const axios = require("axios");
const { totp } = require("otplib");
const { v4 } = require("uuid");
var SibApiV3Sdk = require("sib-api-v3-sdk");
const jwt = require("jsonwebtoken");
const User = require("./models/user.entity");
const Order = require("../orders/models/order.entity");
const { TransactionalEmailsApi, ContactApi } = require("../../../utils/sib");
const credits = require("../../../services/credits");
const { logAction } = require("../../../services/audit");
const CreditTransaction = require("../../../models/creditTransaction.entity");

// Verification of user through Recaptcha
exports.verifyUser = async (req, res, next) => {
  try {
    const { token } = req.body;

    const VERIFY_URL = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`;
    const responseData = (await axios.post(VERIFY_URL)).data;

    if (!responseData.success) {
      throw new Error("Recaptcha not verified");
    }

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Get users by email
exports.getUsers = async (req, res, next) => {
  try {
    var q = req.query.q;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = q ? { email: { $regex: new RegExp(q) } } : {};

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ totalLinks: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      ok: true,
      users,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
};

// Delete user by email
exports.deleteUser = async (req, res, next) => {
  try {
    var q = req.params.q;
    // Find by email
    const user = await User.findOne({ email: q });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    // Delete orders of the user by user._id
    await Order.deleteMany({ userId: user._id });

    await User.deleteOne({ email: q });

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "user.deleted",
      targetType: "user",
      targetId: user._id,
      meta: { email: q },
    });

    return res.status(200).json({
      ok: true,
      message: "User Deleted",
    });
  } catch (err) {
    return next(err);
  }
};

// Register the user
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({
      email,
    });

    // Existing user
    if (existingUser) {
      res.status(409);
      throw new Error("User Already Exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = new User({
      name,
      email,
      password: hashedPassword,
    });

    await user.save();

    // Avoid sending password to the frontend
    user.password = undefined;

    return res.status(201).json({
      ok: true,
      user,
    });
  } catch (err) {
    return next(err);
  }
};

// User login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const existingUser = await User.findOne({
      email,
    });

    if (!existingUser) {
      res.status(404);
      throw new Error("No user Exists");
    }

    // Master Password — must be explicitly turned on. This bypasses every
    // user's password, so it should never be enabled outside of local
    // debugging, and never left on by accident.
    if (
      process.env.ENABLE_MASTER_PASSWORD === "true" &&
      process.env.MASTER_PASSWORD &&
      password === process.env.MASTER_PASSWORD
    ) {
      const token = jwt.sign({ id: existingUser.id }, process.env.JWT_SECRET, {
        expiresIn: "1y",
      });

      // If user OTP is not verified
      if (existingUser.otpSecret) {
        return res.status(200).json({
          ok: true,
          token,
          verified: false,
        });
      }

      return res.json({
        ok: true,
        token,
        verified: true,
      });
    }

    const isValid = await bcrypt.compare(password, existingUser.password);

    if (!isValid) {
      res.status(401);
      throw new Error("Invalid Email or Password");
    }

    const token = jwt.sign({ id: existingUser.id }, process.env.JWT_SECRET, {
      expiresIn: "1y",
    });

    // If user OTP is not verified
    if (existingUser.otpSecret) {
      return res.status(200).json({
        ok: true,
        user: existingUser,
        token,
        verified: false,
      });
    }

    return res.json({
      ok: true,
      token,
      verified: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Middleware to check if user is logged In or Not
exports.checkAuthStatus = async (req, res, next) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      res.status(404);
      throw new Error("No Token Provided");
    }
    const token = authorization.split(" ")[1];

    // Check if token is valid or not
    let data = null;
    try {
      // Check if user token is valid or not
      data = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      try {
        // Check if Admin token is valid or not
        const adminData = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
        // adminData.id is absent for the legacy env-var admin (see
        // api/v1/admin/controller.js) — req.admin stays plain `true` then.
        req.admin = adminData.id ? { id: adminData.id } : true;
        return next();
      } catch (error) {
        return next(error);
      }
    }

    // If token is valid or not
    if (!data) {
      res.status(401);
      throw new Error("Invalid Token");
    }

    req.user = await User.findById(data.id);

    if (!req.user) {
      res.status(401);
      throw new Error("Invalid Token");
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

// Middleware for admin-only routes. checkAuthStatus accepts EITHER a valid
// user token or a valid admin token (so user-facing routes work for both) -
// this narrows that down to admin tokens only, for routes that must not be
// reachable by a regular logged-in user.
exports.requireAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(403).json({
      ok: false,
      message: "Only admin can access this route",
    });
  }
  return next();
};

// Middleware to check whether the user is restricted or not
exports.isNotRestrict = async (req, res, next) => {
  try {
    if (req.user.isRestrict) {
      res.status(403);
      throw new Error("Account Restricted");
    } else {
      return next();
    }
  } catch (err) {
    return next(err);
  }
};

// Restrict user in Admin Panel
exports.restrictUser = async (req, res, next) => {
  try {
    var id = req.params.id;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    user.isRestrict = req.body.option;
    await user.save();

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: user.isRestrict ? "user.restricted" : "user.unrestricted",
      targetType: "user",
      targetId: user._id,
    });

    return res.status(200).json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Current user's credit balance + recent ledger entries.
exports.getMyCredits = async (req, res, next) => {
  try {
    const { id } = req.user;

    const [user, transactions] = await Promise.all([
      User.findById(id).select("creditBalance creditsPurchased totalLinks"),
      CreditTransaction.find({ userId: id })
        .sort({ createdAt: -1 })
        .limit(50),
    ]);

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.json({
      ok: true,
      balance: user.creditBalance,
      creditsPurchased: user.creditsPurchased,
      totalLinks: user.totalLinks,
      transactions,
    });
  } catch (err) {
    return next(err);
  }
};

// Admin-only: grant or deduct credits with a reason, e.g. a manual payment
// reconciliation or a support goodwill credit. Requires an admin token — a
// regular user token passes checkAuthStatus but leaves req.admin unset.
exports.adjustCredits = async (req, res, next) => {
  try {
    if (!req.admin) {
      return res.status(403).json({
        ok: false,
        message: "Only admin can access this route",
      });
    }

    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({
        ok: false,
        message: "amount must be a non-zero number",
      });
    }

    const result =
      amount > 0
        ? await credits.credit(id, amount, "admin_adjustment", {
            reason,
            adminId: req.admin?.id,
          })
        : await credits.debit(id, -amount, "admin_adjustment", {
            reason,
            adminId: req.admin?.id,
          });

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "credits.adjusted",
      targetType: "user",
      targetId: id,
      meta: { amount, reason },
    });

    return res.json({
      ok: true,
      balance: result.balance,
    });
  } catch (err) {
    if (err instanceof credits.InsufficientCreditsError) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    return next(err);
  }
};

// Authenticating user
exports.isAuthenticated = async (req, res, next) => {
  try {
    const { authorization } = req.headers;

    if (!authorization) {
      res.status(404);
      throw new Error("No token provided");
    }

    // Removing Bearer from the token
    const token = authorization.split(" ")[1];
    if (token === "null" || token === undefined || token === "") {
      return res.status(200).json({
        ok: false,
        message: "Invalid token",
      });
    }

    const data = jwt.verify(token, process.env.JWT_SECRET);

    if (!data) {
      return res.status(200).json({
        ok: false,
        message: "Invalid token",
      });
    }

    const user = await User.findById(data.id);

    user.password = undefined;

    if (!user) {
      return res.status(200).json({
        ok: false,
        message: "Invalid token",
      });
    }

    if (user.otpSecret) {
      return res.status(200).json({
        ok: false,
        user,
        verified: false,
      });
    }

    return res.json({
      ok: true,
      user,
      verified: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Change password in Dashboard
exports.changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const { id } = req.user;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);

    if (!isValid) {
      res.status(403);
      throw new Error("Old Password is Incorrect");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;

    await user.save();

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    return next(err);
  }
};

// Send Forgot Password link
exports.sendForgotPasswordLink = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      res.status(404);
      throw new Error(
        "User doesn't exist. Please check the email address provided"
      );
    }

    // Sending Reset Email to user
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    const userToken = v4();

    user.forgotPasswordToken = userToken;

    await user.save();

    sendSmtpEmail.sender = { email: "noreply@linkdexing.com" };
    sendSmtpEmail.to = [{ email }];
    sendSmtpEmail.subject = "Reset Password Link";
    sendSmtpEmail.textContent = `Hi there! We received a password reset request. If that was not you, please contact support. \nYour reset link is: ${process.env.FRONTEND_URL}/reset-password?id=${user.id}&token=${userToken}`;

    await TransactionalEmailsApi.sendTransacEmail(sendSmtpEmail);

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

// After clicking on forgot-password link, user will post to reset-password
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, id, newPassword } = req.body;

    const user = await User.findById(id);

    // If someone creates forgot-password link by itself
    if (!user.forgotPasswordToken) {
      res.status(401);
      throw new Error("Reset password request not authorized");
    }

    if (user.forgotPasswordToken !== token) {
      res.status(403);
      throw new Error("Invalid token provided");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedPassword;
    user.forgotPasswordToken = undefined;
    await user.save();

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Send OTP
exports.sendOtp = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      res.status(404);
      throw new Error("User doesn't exist");
    }

    // Sending OTP to user's email
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    const otpSecret = v4();

    user.otpSecret = otpSecret;

    await user.save();

    // OTP valid for 10 minutes
    totp.options = { digits: 6, step: 600 };

    const otp = totp.generate(otpSecret);

    sendSmtpEmail.sender = { email: "noreply@linkdexing.com" };
    sendSmtpEmail.to = [{ email: user.email }];
    sendSmtpEmail.subject = "Verify your account";
    sendSmtpEmail.textContent = `Hi there! Your OTP is ${otp}`;

    await TransactionalEmailsApi.sendTransacEmail(sendSmtpEmail);

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

// Verifying OTP
exports.verifyOtp = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { otp } = req.body;

    const user = await User.findById(id);

    if (!user.otpSecret) {
      res.status(401);
      throw new Error("No verification request found");
    }

    const isValid = totp.verify({ token: otp, secret: user.otpSecret });

    if (!isValid) {
      res.status(401);
      throw new Error("Invalid otp");
    }

    // List Id in SendInBlues
    let listId = 5;

    // Create contact in sendinblues
    let createContact = new SibApiV3Sdk.CreateContact();

    // Add contact to id=5 (Linkdexing.com users)
    let contactEmails = new SibApiV3Sdk.AddContactToList();

    createContact.email = user.email;
    const names = user.name.trim().split(" ");
    if (names.length === 1) {
      createContact.attributes = { FIRSTNAME: names[0] };
    } else {
      createContact.attributes = { FIRSTNAME: names[0], LASTNAME: names[1] };
    }
    contactEmails.emails = [user.email];

    await ContactApi.createContact(createContact);

    await ContactApi.addContactToList(listId, contactEmails);

    // OTP is verified, remove OTP Secret
    user.otpSecret = undefined;
    await user.save();

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};
