
const http = require("http");

const STK = process.env.STK;
const BANK = (process.env.BANK || "ICB").toUpperCase();
const API_KEY = process.env.API_KEY;

const donHang = {};

const BINS = {
    ICB: "970415",
    VCB: "970436"
};

function tlv(id, value) {
    value = String(value);
    return id + String(value.length).padStart(2, "0") + value;
}

function crc16(text) {
    let crc = 0xFFFF;

    for (let i = 0; i < text.length; i++) {
        crc ^= text.charCodeAt(i) << 8;

        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000)
                ? ((crc << 1) ^ 0x1021) & 0xFFFF
                : (crc << 1) & 0xFFFF;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0");
}

function taoChuoiQR(soTien, noiDung) {
    const bin = BINS[BANK];

    if (!STK || !/^\d{1,19}$/.test(STK) || !bin) {
        throw new Error("Kiem tra STK va BANK tren Render");
    }

    const taiKhoan =
        tlv("00", bin) +
        tlv("01", STK);

    const merchantInfo =
        tlv("00", "A000000727") +
        tlv("01", taiKhoan) +
        tlv("02", "QRIBFTTA");

    let data =
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("38", merchantInfo) +
        tlv("52", "0000") +
        tlv("53", "704") +
        tlv("54", soTien) +
        tlv("58", "VN") +
        tlv("62", tlv("08", noiDung));

    data += "6304";
    data += crc16(data);

    return data;
}

function taoDon(sanPham) {
    let gia;

    if (sanPham === "Tra") gia = 10000;
    else if (sanPham === "Ca phe") gia = 15000;
    else throw new Error("San pham khong hop le");

    if (!STK || !API_KEY || !BINS[BANK]) {
        throw new Error("Kiem tra STK, BANK, API_KEY tren Render");
    }

    const maDon = "DH" + Date.now();
    const noiDung = "SEVQR " + maDon;
    const qrData = taoChuoiQR(gia, noiDung);

    donHang[maDon] = {
        sanPham,
        soTien: gia,
        trangThai: "cho_thanh_toan"
    };

    // Giu nguyen cau truc lenh da dung trong project Nextion.
    // Can doi toa do/kich thuoc theo giao dien thuc te.
    const nextionCommand =
        'qrcode 20,20,200,65535,0,-1,"' + qrData + '"';

    console.log("Tao don:", maDon, gia);

    return {
        maDon,
        soTien: gia,
        noiDung,
        qrData,
        nextionCommand,
        trangThai: "cho_thanh_toan"
    };
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    function json(status, data) {
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8"
        });
        res.end(JSON.stringify(data));
    }

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("May ban nuoc QR server dang hoat dong");
        return;
    }

    // Tao don cho Nextion Debug.
    if (req.method === "GET" && url.pathname === "/tao-qr") {
        try {
            return json(200, taoDon(url.searchParams.get("sanPham")));
        } catch (err) {
            return json(400, { loi: err.message });
        }
    }

    // API cu: MIT App Inventor.
    if (req.method === "POST" && url.pathname === "/tao-don") {
        let body = "";

        req.on("data", data => body += data);

        req.on("end", () => {
            try {
                const don = JSON.parse(body);
                const result = taoDon(don.sanPham);

                const qrUrl =
                    "https://qr.sepay.vn/img?acc=" +
                    encodeURIComponent(STK) +
                    "&bank=" + encodeURIComponent(BANK) +
                    "&amount=" + result.soTien +
                    "&des=" + encodeURIComponent(result.noiDung);

                json(200, {
                    maDon: result.maDon,
                    soTien: result.soTien,
                    qrUrl,
                    qrData: result.qrData,
                    trangThai: result.trangThai
                });
            } catch (err) {
                json(400, { loi: err.message });
            }
        });

        return;
    }

    if (req.method === "GET" && url.pathname === "/trang-thai") {
        const maDon = url.searchParams.get("maDon");
        const don = donHang[maDon];

        return json(200, don ? {
            maDon,
            trangThai: don.trangThai,
            soTien: don.soTien
        } : {
            trangThai: "khong_tim_thay"
        });
    }

    if (req.method === "POST" && url.pathname === "/webhook/sepay") {
        if (!API_KEY ||
            req.headers.authorization !== "Apikey " + API_KEY) {
            return json(401, { success: false });
        }

        let body = "";

        req.on("data", data => body += data);

        req.on("end", () => {
            try {
                const gd = JSON.parse(body);

                const noiDung = String(gd.content || "").toUpperCase();
                const tienNhan = Number(gd.transferAmount);
                const tienVao =
                    String(gd.transferType || "").toLowerCase() === "in";

                if (tienVao) {
                    for (const maDon in donHang) {
                        const don = donHang[maDon];

                        if (
                            noiDung.includes(maDon.toUpperCase()) &&
                            tienNhan === don.soTien &&
                            don.trangThai === "cho_thanh_toan"
                        ) {
                            don.trangThai = "thanh_cong";
                            console.log("DA THANH TOAN:", maDon);
                            break;
                        }
                    }
                }

                // SePay yeu cau HTTP 200 va {"success": true}.
                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                json(400, { success: false });
            }
        });

        return;
    }

    res.writeHead(404);
    res.end("Khong tim thay");
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server dang chay tai cong " + PORT);
});
