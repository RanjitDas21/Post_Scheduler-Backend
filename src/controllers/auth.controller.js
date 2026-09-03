import { User } from "../models/user.model.js";

// Register a new user
export const signup = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required"});
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const emailRegex = /^([\w\.\-_]+)?\w+@[\w-_]+(\.\w+){1,}$/igm;
    if(!emailRegex.test(email)) {
      return res.status(400).json({massage: "Invalid email format"});
    }

    const existedUser = await User.findOne({email})
    
        if(existedUser) {
            return res.status(400).json({message: "Email already exists"});
        }

    const newUser = await User.create({
      fullName,
      email,
      password,
    });

    const createdUser = await User.findById(newUser._id).select("-password")

        const options = {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: true
        }

    if(createdUser) {
      const token = newUser.generateAuthToken();

    res
      .status(201)
      .cookie("token", token, options)
      .json({message: "User Registered Successfully",token, createdUser});
      } else {
          return res.status(500).json({message: "Something went wrong while registering the user"})
      }
  } catch (error) {
    console.log("Error in signup controller: ", error.message);
        res.status(500).json({message: "Internal server error123"}) 
  }
};



// Log in an existing user
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "That email and password don't match." });
    }

    res.json({
      token: generateToken(user._id),
      user: user.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
};

// @desc  Get the logged-in user's profile
// @route GET /api/auth/me
export const getMe = async (req, res) => {
  res.json({ user: req.user.toSafeObject() });
};
