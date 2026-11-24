def text root {
    content = "root"
    x = 10%
    y = 10%
    duration = 6s
}
def text leaf {
    content = "leaf"
    parent = "root"
    x = 0.5
}
def button btn {
    text = "go"
    x = 40%
    y = 70%
    target = av {
        av = 170001
        page = 2
        time = 3.5s
    }
}
def path shape {
    d = "M0 0 L10 10"
    viewBox = "0 0 10 10"
    width = 20%
    borderColor = 0xff0000
}
set btn { text = "went" } 1s
set shape { x = 50% fillAlpha = 0.5 } 2s
def button orphan {
    text = "bad parent"
    parent = "btn"
}
