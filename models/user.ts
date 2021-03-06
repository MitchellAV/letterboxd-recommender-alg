import mongoose from "mongoose";
const Schema = mongoose.Schema;

const movieSchema = new Schema({
	_id: { type: Number, unique: true },
	rating: { type: Number, min: 1, max: 10 }
});
const watchListSchema = new Schema({
	_id: { type: Number, unique: true }
});
const followingSchema = new Schema({
	_id: { type: String, unique: true }
});

const userSchema = new Schema(
	{
		_id: { type: String },
		movies: [movieSchema],
		watchList: [watchListSchema],
		following: [followingSchema],
		status: { type: String, enum: ["success", "failed", "working"] }
	},
	{ timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
