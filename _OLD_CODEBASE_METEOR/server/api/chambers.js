
WebApp.connectHandlers.use('/api/chambers', async (req, res) => {
    const { province } = req.query;

    if (!province) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Province is required.' }));
        return;
    }

    try {
        console.log('Fetching chambers for province:', province);
        const chambers = await Chambers.find({ province }).fetchAsync();

        if (!chambers.length) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No chambers found for the specified province.' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chambers));
    } catch (error) {
        console.error('Error fetching chambers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
});
