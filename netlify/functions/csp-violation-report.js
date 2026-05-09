exports.handler = async (event) => {
  try {
    const report = JSON.parse(event.body);
    console.log('CSP Violation:', report);
  } catch (error) {
    console.error('Error parsing CSP violation report:', error);
  }

  return {
    statusCode: 204, // No Content
  };
};