WebApp.connectHandlers.use('/api/chamber', async (req, res) => {

    const { province, chamber } = req.query;
    console.log("CHAMBER DETAILS:");
    console.log(province);
    console.log(chamber);

    if (!province) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Province is required.' }));
        return;
    }
    if (!chamber) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chamber is required.' }));
        return;
    }

    try {
        console.log('Fetching chamber details');
        const chamberDetails = await Chambers.findOneAsync({ province: province, seoUrl: chamber });

        if (!chamberDetails) {
            console.log("No chambers found for the specified province: ", province + " and chamber: ", chamber);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No chambers found for the specified province.' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chamberDetails));
    } catch (error) {
        console.error('Error fetching chamber:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
});