def button obj_cb {
    text = "点我"
    x = 50%
    y = 80%
    fillColor = 0xffa0a0
    fillAlpha = 0.6
    target = av {
        av = 170001
        page = 2
        time = 12.5s
    }
    duration = 5s
}
set obj_cb { x = 50% } 0s
then set obj_cb { x = 60% } 1s
then set obj_cb { text = "再点" } 0s

def path obj_cp {
    d = "M0 0 L100 0 L100 100 Z"
    viewBox = "0 0 100 100"
    borderWidth = 2
    borderColor = 0x0000ff
    fillAlpha = 0.3
    width = 20%
    height = 80
    duration = 3s
    alpha = 0
}
set obj_cp {} 2s
then set obj_cp { alpha = 1 } 0s
