const dotenv = require("dotenv").config();
const mongoose = require("mongoose");

const { update_tags } = require("./util/database-functions");

mongoose
	.connect(process.env.MONGODB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
		useFindAndModify: false,
		useCreateIndex: true
	})
	.then(async (result) => {
		console.log("Sucessfully Connected to MongoDB Atlas Database");
		await update_tags();
		console.log("tags updated");
	});
