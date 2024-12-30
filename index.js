const express = require("express");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://food-sharing-fde2a.web.app",
      "https://food-sharing-fde2a.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

function authenticateJWT(req, res, next) {
  const token = req.cookies.token;
  // console.log(token);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden: Invalid token" });
    }

    req.user = user;
    next();
  });
}

// MongoDB URI and Client
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kisu1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    console.log("db-connect");

    const db = client.db("foodSharing");
    const foodCollection = db.collection("foods");
    const requestCollection = db.collection("request");

    // auth related APIs using jwt
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10h",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Home Route
    app.get("/", (req, res) => {
      res.send("Food Sharing Website is Running...");
    });

    // Add Food Route
    app.post("/foods", async (req, res) => {
      try {
        const food = req.body;
        const result = await foodCollection.insertOne(food);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to add food" });
      }
    });

    // Get Available Foods
    app.get("/foods", async (req, res) => {
      try {
        const foods = await foodCollection
          .find({ foodStatus: "available" })
          .toArray();
        res.send(foods);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch foods" });
      }
    });

    app.get("/foods", async (req, res) => {
      try {
        const { status, sortOrder } = req.query;
        const sortOptions = sortOrder === "desc" ? -1 : 1;

        const foods = await foodCollection
          .find({ foodStatus: status })
          .sort({ expiredDate: sortOptions });
        res.json(foods);
      } catch (error) {
        res.status(500).send("Error fetching foods");
      }
    });

    // Update Food Status
    app.put("/myfoods/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid ID format" });
        }

        const filter = { _id: new ObjectId(id) };
        const options = { upsert: false }; // Prevent unintended creation of new documents
        const updateFood = req.body;

        const food = {
          $set: {
            foodName: updateFood.foodName,
            foodImage: updateFood.foodImage,
            foodQuantity: updateFood.foodQuantity,
            pickupLocation: updateFood.pickupLocation,
          },
        };

        const result = await foodCollection.updateOne(filter, food, options);

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ error: "Food item not found or no changes made" });
        }

        res.status(200).json({ message: "Food updated successfully", result });
      } catch (error) {
        console.error("Error updating food:", error);
        res
          .status(500)
          .json({ error: "Failed to update food. Please try again later." });
      }
    });

    //

    // Delete Food
    app.delete("/myfoods/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await foodCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to delete food" });
      }
    });

    app.get("/myfoods/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid ID format" });
        }

        const food = await foodCollection.findOne({ _id: new ObjectId(id) });

        if (!food) {
          return res.status(404).json({ error: "Food not found" });
        }
        res.json(food);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/requests/:email", async (req, res) => {
      try {
        const { email } = req.params;

        if (!email) {
          return res
            .status(400)
            .json({ message: "Email parameter is required." });
        }

        const requests = await foodCollection
          .find({
            donatorEmail: email,

            foodStatus: "requested",
          })
          .toArray();

        if (!requests.length) {
          return res
            .status(404)
            .json({ message: "No requests found for this email." });
        }

        res.status(200).json(requests);
      } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ message: "Error fetching requests", error });
      }
    });

    app.get("/myfoods", authenticateJWT, async (req, res) => {
      try {
        console.log(req.user);
        const donatorEmail = req.user.email;

        const foods = await foodCollection.find({ donatorEmail }).toArray();
        res.status(200).json(foods);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch foods" });
      }
    });

    // Get food details by ID
    app.get("/foods/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const query = { _id: new ObjectId(id) };
        const food = await foodCollection.findOne(query);

        if (!food) {
          return res.status(404).json({ message: "Food not found" });
        }
        res.json(food);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post('/foods-request', async (req, res) => {
      const { _id, ...food } = req.body;
      console.log(_id,food);
      const reqResult = await requestCollection.insertOne(food);
      if (reqResult.acknowledged) {
        
          const query = { _id: new ObjectId(_id) }
          const options = { upsert: true }
          const updateDoc = {
              $set: {
                  foodStatus: food.foodStatus,
                  updatedAt: new Date(),
              }
          }
          const result = await foodCollection.updateOne(query, updateDoc, options);
          res.send(result);
      } else {
          res.status(500).json({ message: 'Failed to create food request.' });
      }
  });

    // app.post("/foods-request", async (req, res) => {
    //   const { id } = req.body;
    //   console.log(req.body);
    //   const {
    //     userEmail,
    //     requestDate,
    //     additionalNotes,
    //     foodStatus,
    //     ...otherDetails
    //   } = req.body;
    //   const requestCollection = await requestCollection.insertOne(req.body);

    //   const food = await foodCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $set: {
    //         foodStatus: foodStatus,

    //         updatedAt: new Date(),
    //       },
         
    //     }, {
    //       upsert:true,
    //     }


    //   );
    //   // console.log(food);

    //   if (!food.modifiedCount) {
    //     return res.status(404).json({ message: "Food not found" });
    //   }
    //   return res.status(200).send(food);
    // });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", async (req, res) => {
  res.send(`server running on ${port}`);
});
app.listen(port, () => {
  console.log("server running");
});

