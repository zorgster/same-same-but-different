const fs = require("fs");
const path = require("path");

const dataFilePath = path.resolve(__dirname, "tool-usage-data.json");

exports.handler = async (event) => {
  try {
    // Parse the incoming request
    const { tool } = JSON.parse(event.body);

    if (!tool) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Tool name is required." }),
      };
    }

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];

    // Read the existing data
    let data = {};
    if (fs.existsSync(dataFilePath)) {
      const fileContent = fs.readFileSync(dataFilePath, "utf-8");
      data = JSON.parse(fileContent);
    }

    // Ensure the structure for the tool and date exists
    if (!data[tool]) {
      data[tool] = {};
    }
    if (!data[tool][today]) {
      data[tool][today] = 0;
    }

    // Increment the counter for the specified tool and date
    data[tool][today] += 1;

    // Write the updated data back to the file
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Counter updated for tool: ${tool}`, date: today, count: data[tool][today] }),
    };
  } catch (error) {
    console.error("Error handling request:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};