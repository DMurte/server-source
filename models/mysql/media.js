const shortId = require('shortid');
//const imageMin = require('imagemin');
//const imageMinWebp = require('imagemin-webp');
const path = require('path');

module.exports = {
    getById: async function (mediaId) {
        if(!mediaId)
            return null;
        let [media, ignored] = await sql.query("SELECT * FROM media WHERE id = ?", [mediaId]);
        if (media.length)
            return media[0];
        else
            return null;
    },
    removePicture: async function(mediaId) {
        try {
            let previousImage = await this.getById(mediaId);
            if (previousImage !== null && previousImage.address !== null) {
                previousImage = "/srv/" + previousImage.address;
                await fs.statAsync(previousImage);
                return fs.unlinkAsync(previousImage);
            }
        }
        catch (err) {
            console.log(err);
        }
    },
    updateDatabase: async function (mediaId,path) {
        let result = await sql.query("UPDATE media SET address = ?, path_type = 'relative' WHERE id = ?",[path,mediaId]);
        return result.affectedRows === 1;
    },
    doUpload: async function (buffer, mediaId) {
        const fileName = shortId.generate() + '.webp';
        let mediaType = (await this.getById(mediaId)).type;
        const relativePath = "img/" + mediaType + '/' + fileName;
        const fullPath = "/srv/" + relativePath;
        /*/let newBuffer = await imageMin.buffer(buffer, {
            use: [
                imageMinWebp({quality: 50})
            ]
        });*/
        if(!fs.isDir(fullPath))
            await fs.mkdirp("/srv/img/" + mediaType);
        let fd = await fs.openAsync(fullPath, 'a', 0o755);
        await fs.writeAsync(fd, buffer, 'binary');
        await fs.closeAsync(fd);
        await this.removePicture(mediaId);
        await this.updateDatabase(mediaId,relativePath);
        return (await mysql.getOneRow('media', {id: mediaId}));
    }

};
fs.isDir = function(dpath) {
    try {
        return fs.lstatSync(dpath).isDirectory();
    } catch(e) {
        return false;
    }
};
fs.mkdirp = async function(dirpath, mode) {
    dirpath = path.resolve(dirpath);

    if (typeof mode === 'undefined') {
        mode = parseInt('0777', 8) & (~process.umask());
    }

    try {
        if (!fs.statSync(dirpath).isDirectory()) {
            throw new Error(dirpath + ' exists and is not a directory');
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            fs.mkdirp(path.dirname(dirpath), mode);
            fs.mkdirSync(dirpath, mode);
        } else {
            throw err;
        }
    }
};